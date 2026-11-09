# c52 local runtime plan — preparation only

**Status: NOT RUN.** This is an execution plan for one later, explicitly released
local functional browser run. No process was started, database created, browser
opened, or network request made by this task. Port availability was outside this
preparation packet's scope; the primary task has a separate read-only listener
snapshot. This packet owns only this plan file.

## Pinned inputs and endpoint layout

The provided native executable is
`/Users/nevinmckinnon/.codex/tools/rougehalla-stage2/return-cleanup-2026-11-08/native-browser-c52-build/rh-server`,
SHA-256 `2533c89b6581610a33a79ff95492989711a33d52999efdd2fc045cb771a62a65`.
Its adjacent build receipt says it came from c52 with
`cargo build -p rh-server --features postgres --locked --offline`, dev/debug
profile, one build job, incremental compilation off, and debug info level zero.
It explicitly records that the server and PostgreSQL were not started. It is a
functional local binary, not release/performance evidence. The Web1 build was
held after three serialized asset drifts. The coordinator has released the
Web2 build from source target `57e166f46b35fb703e5f3c76914fcc4e8bf3191c`, but
its immutable Web output pins are still forthcoming. Use only that released
Web2 artifact after its complete pin receipt is available; do not serve Web1 or
an older build.

Planned loopback endpoints:

| Component | Listener | Use |
| --- | --- | --- |
| Source arena | `127.0.0.1:7777` | Normal owned-account WebSocket, profile API, Source `/info` and readiness |
| Training | `127.0.0.1:7779` | Training WebSocket and process `/info`; no Source result or settlement |
| Local static/router | `localhost:8888` | The sole browser page, both WS URLs, and account API origin |
| Fresh PostgreSQL | Unix socket at `/private/tmp/rh-browser-c52-pg-65439/.s.PGSQL.65439` | Private profile/auth/session/result store; no TCP listener |

The source-only router proposal at
`tools/unity-browser-reload-proof/Caddyfile.local.proposal` now names
`http://localhost:8888` and binds both loopback addresses. Caddy is not
available in the current PATH, and the cached staging Caddy binary is Linux
ELF; neither is the execution path for this local run. The primary is preparing
a source-only built-in Node router fallback; it is pending review and is not
started. The required sole browser origin is
`http://localhost:8888`; its router must accept both `127.0.0.1:8888` and
`[::1]:8888` loopback connections only. The browser configuration is
`?server=ws://localhost:8888/ws&trainingServer=ws://localhost:8888/training/ws`.
Keep the router listener, Unity page configuration, and native
`--api-cors-origins http://localhost:8888` consistent. The router must replace
incoming `X-Forwarded-For` with the actual loopback peer address, preserve the
browser's exact `Origin`, and serve only the released static asset manifest;
both native profiles will declare `--client-ip-header x-forwarded-for`. Do not bind
`0.0.0.0` or `::`, open direct browser connections to 7777/7779, or mix
`localhost` and `127.0.0.1` across the account API and game endpoints: the client
requires one same-origin scheme, host, and port. The router is pending review
and still needs local routing, CORS, WebSocket-upgrade, and static-asset checks.

The primary's separate read-only snapshot reports the planned short socket
path absent. Port 65439 names a Unix socket, not a TCP listener; before a future
run, recheck that exact path is still absent and not a symlink. The separate
listener snapshot covers the TCP listeners 7777, 7779, and 8888. If any target
is occupied or ownership is unclear, stop and obtain a newly reviewed endpoint;
never attach this plan to or terminate an unknown process.

## Private durable state

Use only this fresh, task-owned state root:

`/Users/nevinmckinnon/.codex/tools/rougehalla-stage2/return-cleanup-2026-11-08/browser-c52-actual`

Create it with owner-only permissions (0700), with separate private paths for
the PostgreSQL data directory, Source spool, process logs, and private runtime
configuration. Darwin's `sockaddr_un.sun_path` is 104 bytes. The long state
root cannot contain a PostgreSQL socket: the generated `.s.PGSQL.65439` socket
path would exceed that limit. Use the separately owned, short socket directory
`/private/tmp/rh-browser-c52-pg-65439`; its directory path is 36 bytes and the
socket filename path is 51 bytes (52 including NUL), below the 104-byte array.
Before a future run, require that exact directory to be absent, non-symlinked,
and under the expected owner; create it with mode 0700 only then. If it exists
or ownership is unexpected, stop and choose a newly reviewed short path. Never
reuse or delete an unknown socket directory. Treat the state root and instance
IDs below as a single first-attempt allocation; after an interrupted attempt,
preserve existing data and ask Root to assign a new root and IDs before retry.
Give each service a unique
instance ID. The
passcode and any account/profile credentials remain in a private 0600
environment/config channel; never put secret values in command arguments,
browser URLs, evidence, logs, shell history, or model-visible output. Do not
dump environment variables or database/profile/token rows. Do not capture raw
spool records, replay inputs, HTTP bodies, profile tokens, or session
capabilities.

Initialize a new local PostgreSQL 16 cluster and a dedicated empty database
inside this state root. Place only the short Unix socket in the separate path
above. Require and verify `fsync=on`,
`synchronous_commit=on`, and `full_page_writes=on` using fixed `SHOW` checks
before starting either server. Keep PostgreSQL data inside the private root and
the short Unix socket in its separately owned directory; use a private database role with only the access needed by these local
processes. Do not reuse a shared/development cluster. In particular,
`tools/pgtest/start.sh` is unsuitable for this durability proof because its
test cluster disables those three durability settings.

The c52 binary has PostgreSQL support and performs schema migration at startup.
It does **not** read a `DATABASE_URL` environment fallback:
`crates/rh-server/src/main.rs` obtains the database URL only from
`--database-url`; its environment lookups are for `PLAYTEST_PASSCODE` and bot
configuration. Installed `sqlx-postgres` 0.8.6
`src/options/parse.rs` confirms that a Unix socket directory can be provided in
the URL's `host` query parameter. Use the owner-only short socket and a dedicated `rh_game LOGIN NOSUPERUSER`
role, with the local OS user mapped to that role through `pg_ident.conf` and
peer authentication. Keep PostgreSQL TCP listening disabled; port 65439 is
only the Unix socket filename port. The credential-free DSN
for both server processes is:

```text
postgresql://rh_game@localhost/roguehalla?host=%2Fprivate%2Ftmp%2Frh-browser-c52-pg-65439&port=65439
```

The encoded `host` decodes to the private socket directory. The username and
database name are identifiers, not credentials; the URL contains no password.
First verify the socket connection and durability settings with `psql`; then
start the game server. The server's own startup connects and migrates before
its public listener becomes ready. Do not silently fall back to memory mode if
the DB is unavailable. Record binary/schema identity and migration result
without exposing connection material, and fail closed on migration or
readiness errors. A `--result-spool` fsync protects against
process restart on this host; a commit in this fresh local PostgreSQL cluster
is local durability evidence only. Host-loss or volume recovery remains
unproven. Keep the Source spool in a separate private directory on the owned
state volume, apart from database data and logs. Training gets no result spool.

Future private setup template (all commands below are **NOT RUN**):

```sh
STATE=/Users/nevinmckinnon/.codex/tools/rougehalla-stage2/return-cleanup-2026-11-08/browser-c52-actual
SOCK=/private/tmp/rh-browser-c52-pg-65439
set -eu
LOCAL_OS_ADMIN="$(id -un)"
test "$LOCAL_OS_ADMIN" = nevinmckinnon
test ! -e "$STATE"
test ! -L "$STATE"
test ! -e "$SOCK"
test ! -L "$SOCK"
umask 077
mkdir "$STATE" "$STATE/pgdata" "$STATE/config" "$STATE/logs" "$STATE/spool-source" "$SOCK"
chmod 700 "$STATE" "$STATE/pgdata" "$STATE/config" "$STATE/logs" "$STATE/spool-source" "$SOCK"
initdb -D "$STATE/pgdata" --username "$LOCAL_OS_ADMIN" --auth-local peer --auth-host reject
cp /Users/nevinmckinnon/.codex/tools/rougehalla-stage2/scene-candidate14-clients/repo/maps/first-playable.json "$STATE/config/source-map.json"
# Verify source-map.json SHA-256 is 90bc4c8e82b7d4ba4819843001ae59da35c20ee870b5591b20192082b5bd16aa before server start.
# Replace the default local rules in pg_hba.conf with:
# local roguehalla rh_game peer map=game_map
# local all $LOCAL_OS_ADMIN peer
# host all all 127.0.0.1/32 reject
# host all all ::1/128 reject
# pg_ident.conf: game_map $LOCAL_OS_ADMIN rh_game
# postgresql.conf:
# listen_addresses = ''
# port = 65439
# unix_socket_directories = '/private/tmp/rh-browser-c52-pg-65439'
# unix_socket_permissions = 0700
# fsync = on
# synchronous_commit = on
# full_page_writes = on
pg_ctl -D "$STATE/pgdata" -l "$STATE/logs/postgres.log" -w start
psql "postgresql://${LOCAL_OS_ADMIN}@localhost/postgres?host=%2Fprivate%2Ftmp%2Frh-browser-c52-pg-65439&port=65439" -X -v ON_ERROR_STOP=1 -c 'CREATE ROLE rh_game LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT' -c 'CREATE DATABASE roguehalla OWNER rh_game'
psql 'postgresql://rh_game@localhost/roguehalla?host=%2Fprivate%2Ftmp%2Frh-browser-c52-pg-65439&port=65439' -X -At -v ON_ERROR_STOP=1 -c 'SHOW fsync' -c 'SHOW synchronous_commit' -c 'SHOW full_page_writes'
```

The actual supervisor should create/chmod the state subdirectories and short
socket directory only after verifying they are new and owned, install the
shown per-cluster config, and replace the socket path only if a newly reviewed
short path is needed. Replace default local authentication rules rather than
appending ambiguous entries. Verify the three expected `on` settings and
reject IPv4 and IPv6 TCP connections. Use private SQL input for role/database
creation if local shell audit rules require it. No TCP listener is configured;
port 65439 names the Unix socket endpoint. The
credential-free runtime DSN uses `rh_game`, never the bootstrap superuser.
After the DB is ready, the supervisor launches each server with the exact
non-secret argv below and inherits only the minimal private environment. c52
has no `DATABASE_URL` environment fallback; do not set one and assume it is
used. If a later setup requires password auth, stop and obtain an approved
secret-delivery implementation rather than placing a password in argv.

## Exact runtime command shapes

These are templates only and were **not executed**. The DSN above has no
password and may be one argv value. A future supervisor should construct the
argument vector directly, set private environment values such as
`PLAYTEST_PASSCODE` only when provisioned, and redact arguments/environment
from logs and diagnostics. Never supply a password-bearing DSN to
`--database-url`; c52 has no environment fallback for it.
Use the pinned c52 executable above and the coordinator-pinned matching Web
artifact. The Source map must be the reviewed and SHA-pinned `rh-map/2` input;
the current map documentation calls `maps/first-playable.json` a hand-authored
admitted map (native map hash `0252d18b`), not a captured parity answer. Its
current checkout file SHA-256 is
`90bc4c8e82b7d4ba4819843001ae59da35c20ee870b5591b20192082b5bd16aa`; verify
against the released artifact inputs before use. The future private copy path
is `$STATE/config/source-map.json`; its SHA must remain exactly that value.

Source arena (ordinary direct owned joins, no hosted admit gate):

```sh
exec /Users/nevinmckinnon/.codex/tools/rougehalla-stage2/return-cleanup-2026-11-08/native-browser-c52-build/rh-server \
  --runtime source-arena \
  --map /Users/nevinmckinnon/.codex/tools/rougehalla-stage2/return-cleanup-2026-11-08/browser-c52-actual/config/source-map.json \
  --bind 127.0.0.1:7777 \
  --database-url 'postgresql://rh_game@localhost/roguehalla?host=%2Fprivate%2Ftmp%2Frh-browser-c52-pg-65439&port=65439' \
  --instance-id c52-browser-source-20261109-1 \
  --result-spool /Users/nevinmckinnon/.codex/tools/rougehalla-stage2/return-cleanup-2026-11-08/browser-c52-actual/spool-source \
  --min-players 2 --fill-bots 0 --max-rooms 16 --lobby-seconds 30 --fill-seconds 5 \
  --bot-learning off --api-cors-origins http://localhost:8888 \
  --client-ip-header x-forwarded-for
```

Training (separate endpoint and process, same fresh private database):

```sh
exec /Users/nevinmckinnon/.codex/tools/rougehalla-stage2/return-cleanup-2026-11-08/native-browser-c52-build/rh-server \
  --runtime training \
  --bind 127.0.0.1:7779 \
  --database-url 'postgresql://rh_game@localhost/roguehalla?host=%2Fprivate%2Ftmp%2Frh-browser-c52-pg-65439&port=65439' \
  --instance-id c52-browser-training-20261109-1 \
  --min-players 1 --fill-bots 0 --max-rooms 1 --lobby-seconds 0 --fill-seconds 0 \
  --bot-learning off --api-cors-origins http://localhost:8888 \
  --client-ip-header x-forwarded-for
```

The argv values above are a credential-free DSN and configuration paths, not
secrets. The private supervisor supplies only secrets such as an optional
`PLAYTEST_PASSCODE` through a restricted environment channel; it must not log
environment contents. `--database-url` and `--result-spool` require the
`postgres` build feature; the pinned receipt confirms that feature. Runtime parser rules require Source
`--map` with a validated `rh-map/2` export, while Training rejects `--map`,
forces one seat and zero lobby/fill durations, and uses its built-in practice
arena. Source defaults are 2 minimum humans, 0 fill bots, 16 rooms, 30-second
lobby and 5-second fill; these are stated explicitly above. `--instance-id`
defaults to a process-derived value, so use explicit unique values to make
writer ownership auditable. `--bot-learning off` is already the default and is
kept explicit.

Use the normal Unity owned-account UI path. `--require-admit` is not appropriate
for this direct-owned join: it defaults off and would require a separately
implemented control-plane admit flow. Do not add `--control`,
`--control-token-file`, or `--require-admit` to these commands. If the fresh
account-claim flow requires `PLAYTEST_PASSCODE`, supply it only through the
private environment channel and only if Root provisions it. Never read or echo
its value. Do not set unreviewed API-limit overrides or relax any defaults.

## Run gates and evidence

Proceed only after Root releases a frozen matching server, Web artifact,
`/info` identity, map hash, router config, and this local run. Verify both
processes are the intended pinned binary with their expected instance IDs.
Check Source and Training `/info`, health/readiness and Web content/protocol
identity through the same router origin; verify WebSocket upgrades and static
resources through the router. Do not infer actual Unity acceptance or gameplay
from matching hashes alone.

Keep the server at its ordinary fixed 20 Hz. The native simulation step is
50 ms; no paused clock, accelerated wall wake, debug state injection, shortened
cooldown, or synthetic Result. The room reconnect grace remains its default
10 seconds. Account creation/claim and both players' joins must use normal UI
and public API flows; the actual Source run needs two human seats. Reach a real
Source gameplay outcome, observe the genuine native `Result`, and let the
Source result-spool→PostgreSQL path commit it. Training is a separate
practice-only run and must not create a normal Result or bank receipt.

For a Source receipt, use the current match UUID represented by the raw Welcome
match bytes (network byte order) and the same current owner. The existing route
is authenticated `GET /api/profile/{name}/matches/{match_id}/settlement`, with
the profile token carried opaquely in `x-profile-token`, never in the URL.
Record only the allowlisted receipt fields (`v`, `matchId`, `status`, and for a
committed result `settlement.outcome` and `settlement.gvCredited`). An `unknown`
status means no commit was visible in that read; it is not proof of pending
work, match existence, or a ledger change. Do not infer balance from the
displayed Result. No raw request/response capture is permitted.

Keep a small reviewed receipt containing only binary/map/Web/router identities,
database durability settings, the private-state-path owner/mode, process
instance IDs and readiness outcomes, genuine outcome/receipt summary, and
allowlisted pending/dead spool counts. Record actual wall-clock elapsed time;
do not reuse accelerated bridge evidence as a timing result. Any failure before
the genuine Result or committed authenticated receipt leaves that part of the
chain unproven.

## Shutdown and remaining boundaries

At completion, first use the normal Unity leave control to release the Training
seat after all Training reload checks; Training has no normal result and an
active room may keep graceful drain waiting for its match to finish. End the
Source match naturally and confirm its genuine result before beginning shutdown.
Then stop only the exact Source, Training, router, and PostgreSQL processes
created for this run. SIGTERM starts Source drain: it refuses new admissions
while active matches finish. After rooms close, the process waits
up to 150 seconds for result writes before graceful HTTP shutdown; if writes
remain pending, retain the spool and database and do not declare the receipt
complete. Spool append is temp-file write, file fsync, rename, then directory
fsync. A full or unwritable spool falls back to in-memory retry, so require zero
spool-full and spool-error counts for a clean durable run. Wait for spool replay
and pending writes to settle, record owned process exits and that owned ports
are closed, then stop Training/router and cold-stop the fresh cluster. Fence
unique instance/lease ownership before restart. Do not remove or overwrite an
unknown process, shared data directory, socket, or spool. Preserve the
private database/spool state after the run until Root reviews the receipt and
explicitly directs retention cleanup; the presence of a task-owned path does
not authorize deleting other state.

This preparation does not establish a running PostgreSQL cluster, a successful
router, actual browser connectivity, a Unity gameplay outcome, durable result
commit, authenticated receipt, performance, deployment readiness, or any AWS
resource status. Older full-runtime account/receipt and browser proofs are
separate historical scopes and are not substitutes for this c52 actual run.
