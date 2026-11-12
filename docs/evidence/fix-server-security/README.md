# Server security hardening for a public launch (fix/server-security)

Base: `integration/backend-unity-union` 976a6559 (protocol 16, content a2d1022ebe713382). Scope: `crates/rh-server` plus the
consumers the change touches. No wire or protocol change: the refusals use existing HTTP statuses before the upgrade and the
existing `RejectCode::RateLimited`; `PROTOCOL_VERSION` and the golden vectors are untouched.

## What changed

| # | Finding (verified in code first) | Fix | Where |
|---|---|---|---|
| 1 | `None \| Some("dev") => Auth::Dev` accepted any callsign with any ticket on any bind | Startup refuses dev auth (no `--database-url`, `--auth` absent or `dev`) on a **publicly exposed** listener unless `--insecure-dev-auth`; with the flag it prints an `INSECURE` warning. Publicly exposed = non-loopback `--bind`, or `--client-ip-header` (a reverse proxy forwards public clients to a loopback bind). Misspelt `--insecure-*` flags are refused | `main.rs` `publicly_exposed`, `exposure_check` (called right after `--bind` is parsed) |
| 2 | `/ws` had no per-address or total socket cap, only the 5 s Hello timeout; bad tickets could hammer `verify_token` | Before the upgrade: global cap on sockets still in their Hello (503), per-address concurrent cap (429) and per-address new-connection token bucket (429), keyed on the real client address through the account API's existing forwarded-header trust rule (`api::resolve_client_ip`, one implementation). After the upgrade: a fresh Hello first reserves a failed-credential slot for its address; over the limit it is answered `RateLimited` before the ticket reaches `Auth::verify` (resumes carry no credential and are not counted) | `edge.rs` `EdgeGuard::admit_ws`, `WsTicket::hello_attempt/hello_done`; `lib.rs` `ws`; `conn.rs` `serve_guarded` |
| 3 | `/ws` accepted any `Origin` (cross-site WebSocket hijacking) | Origin allow-list: `--ws-origins`, defaulting to `--api-cors-origins`. A request without `Origin` is not a browser's and is allowed (tools, Unity editor, bots). An empty list is "any origin" only when not publicly exposed; publicly exposed it refuses every browser origin (with a startup warning). A repeated `Origin` is refused | `edge.rs` `OriginPolicy`; `main.rs` `edge_settings` |
| 4 | No header read timeout (axum-server sets no hyper timer, so hyper's 30 s default never applied) and hyper-util's HTTP-version sniffing waits forever | hyper timer + HTTP/1 `header_read_timeout` (also bounds idle keep-alive), HTTP/2 keep-alive ping/timeout, 64 concurrent streams, 16 KiB header list; `FirstRequestAcceptor` wraps the plain and the TLS acceptor so a connection that sends nothing, or drips an HTTP/2 preface prefix, is closed when the header timeout passes | `edge.rs` `configure_http`, `FirstRequestAcceptor`, `FirstRequestDeadline`; `lib.rs` `serve_with_limits` |
| 5 | Public `/info` exposed room/player/result counters and the last 8 closed rooms' perf stats; `/ping` sent `ACAO: *` | Public `/info` is `{protocol, contentHash, state}`. The full object (same 11 keys) moved to the loopback control listener as `GET /control/info` (behind the control token when one is set). `/ping` CORS follows the `/ws` origin policy (`*` only when that policy is any origin, else the listed origin echoed with `Vary: Origin`) | `director.rs` `public_info`; `control.rs` route + `info`; `lib.rs` `info`, `ping` |
| 6 | `Auth::Static` compared tokens with `==` | Both sides SHA-256 hashed, compared with the existing constant-time `api::limits::ct_eq`; an unknown callsign does the same work | `persist.rs` `Auth::verify` |
| 7 | `--self-signed` (rcgen localhost certificate) could be used on any bind; `--tls-cert` without `--tls-key` silently served plain ws | `--self-signed` on a publicly exposed listener refuses to start unless `--insecure-self-signed` (then an `INSECURE` warning); `--tls-cert`/`--tls-key` must pair; `--self-signed` with a cert pair is refused | `main.rs` `exposure_check` |

New dependency line: `hyper-util = { version = "0.1", features = ["server-auto", "tokio"] }` in `crates/rh-server/Cargo.toml`, the
version already locked through axum-server (0.1.21), named directly only for `hyper_util::rt::TokioTimer`. **Cargo.lock: one line
added** (`"hyper-util"` in rh-server's dependency list); no new package, no version change.

## New flags and defaults

| Flag | Default | Meaning (0 disables a limit) |
|---|---|---|
| `--ws-origins '*'\|o1,o2` | `--api-cors-origins` | browser origins allowed on `/ws` and `/ping` CORS |
| `--ws-max-per-ip N` | 16 | concurrent WebSockets per client address (IPv6: per /64) |
| `--ws-connect-burst N` | 20 | new WebSockets per client address, burst |
| `--ws-connect-per-second N` | 2 | ... then steady per second |
| `--ws-max-pending N` | 256 | process-wide sockets upgraded but not yet answered (Hello) |
| `--ws-auth-fails-per-minute N` | 10 | failed Hello credentials per client address per minute |
| `--ws-auth-fails-per-minute-all N` | 0 (off) | process-wide failed credentials per minute (off: any client could fill it and lock everyone out) |
| `--http-header-timeout-secs N` | 10 (1..=300) | HTTP/1 header read / idle keep-alive / version-sniff deadline |
| `--insecure-dev-auth` | off | accept dev auth on a publicly exposed listener |
| `--insecure-self-signed` | off | accept `--self-signed` on a publicly exposed listener |

Client-address keying: without `--client-ip-header`, a loopback client address (local tooling) is exempt from the
per-address caps (capping it would cap the whole server). **With `--client-ip-header` configured, an address that still
resolves to loopback/unspecified** (header missing, repeated, unparsable, or naming loopback) **is not exempt**: all such
requests count under one shared key (`edge::UNRESOLVED`, `::`) for the concurrent cap, the connect bucket and the failed-Hello
throttle, so stripping the header cannot bypass the limits (review follow-up 1). The global pending cap applies to every
request. Unknown `--ws-*`, `--http-*` and `--insecure-*` flags are refused at startup.

Credential-store outage (review follow-up 2): `Persistence::authenticate` and `Auth::verify` now return `Err` when the store
cannot answer (`verify_token_id` / `profile_id` errors, previously folded into "bad credentials"). The Hello is refused
`RateLimited` with "server busy, storage unavailable; try again shortly" (the same honest existing code the resilience branch
uses for a lease outage; no wire change), the store error goes to the rate-limited log only, and it is **not** counted
against the address's failed sign-in budget (only `BadCredentials` is).

## Exact production flag set

The technical demo (`hosting/technical-demo/bootstrap.py` `app_unit`, behind Caddy on the same host) needs no change; with this
build its unchanged command line resolves as follows:

```
rh-server --runtime source-arena --bind 127.0.0.1:7777 --instance-id <run_id>-source-arena \
  --map <ROOT>/source-map.json --result-spool /var/lib/rougehalla-demo/spool --min-players 1 --fill-bots 8 --max-rooms 1 \
  --lobby-seconds 10 --fill-seconds 3 \
  --database-url postgresql://rougehalla@localhost/roguehalla?host=/run/rh-demo-pg --bot-learning off \
  --api-cors-origins https://play.rougehalla.com --client-ip-header x-forwarded-for --trusted-proxies 127.0.0.1
# (training: --runtime training --bind 127.0.0.1:7779 ... --max-rooms 1 --lobby-seconds 0 --fill-seconds 0, same tail)
```

* publicly exposed (via `--client-ip-header`), PostgreSQL auth: starts; no warnings.
* `/ws` origins = `https://play.rougehalla.com` (the served origin of the Unity Web build and probe page; Caddy forwards
  `Origin` unchanged). Client address = Caddy's `X-Forwarded-For {remote_host}` from the trusted 127.0.0.1 peer.
* edge limits at the defaults above; header timeout 10 s.

Recommended explicit form for a new deployment (same values, stated so a reviewer sees them):

```
... --ws-origins https://play.rougehalla.com --ws-max-per-ip 16 --ws-connect-burst 20 --ws-connect-per-second 2 \
    --ws-max-pending 256 --ws-auth-fails-per-minute 10 --http-header-timeout-secs 10
```

Smoke of the built binary with that shape (`--auth static:` instead of the database, loopback, proxy header):

```
info: {"contentHash":"a2d1022ebe713382","protocol":16,"state":"ready"}
control/info keys: ['closedRooms','contentHash','lobbies','maxRooms','players','protocol','resultsFailed','resultsOk','resultsRefused','rooms','state']
ws origin play: 101   ws origin evil: 403   ws no origin: 101
ping play: access-control-allow-origin: https://play.rougehalla.com vary: Origin   ping evil: (no ACAO)
--bind 0.0.0.0 with dev auth: "refusing to start: dev auth (any callsign is accepted with any ticket) on a publicly exposed
listener (0.0.0.0:...); pass --database-url or --auth static:<file>, or --insecure-dev-auth to accept this deliberately" (exit 2)
```

## Consumers checked

| Consumer | Reads / runs | Status |
|---|---|---|
| `hosting/technical-demo/bootstrap.py` `ready` | `/info` `protocol` + `contentHash` | kept; offline tests pass |
| `client-unity/UnityProject/Tools/build-web.sh` | `/info` `contentHash` | kept |
| `tools/browser-proof/proof.mjs` | `/info` `state` (poll), `protocol`; `--self-signed` on 127.0.0.1 | kept; loopback so self-signed and any origin still allowed |
| `crates/rh-server/web/probe.html` | `/info` `contentHash` | kept |
| `tools/unity-browser-reload-proof/normal-companion.mjs` | `/info` `protocol`, `contentHash` | kept |
| `hosting/placement/probe/local-proof.mjs` | `/info` `state`; cross-origin `/ping`; `--self-signed` / `--tls-cert` on 127.0.0.1 | loopback with no origin list: `/ping` stays `*` |
| `tools/staging-native-artifact/produce.py` + `component.py` | the full 11-key `/info` | **changed**: starts the server with `--control 127.0.0.1:<port>`, reads the counters from `/control/info` and requires the public `/info` to equal its identity+state; `component.py` and the manifest format unchanged; `test_produce.py` updated (25 tests pass) |
| `tools/staging-full-runtime/run-runtime.py` | database + `--api-cors-origins https://rougehalla.com` + proxy header | unaffected (page origin is `https://rougehalla.com`) |
| `hosting/glbridge` `serverArgs` | `--bind 0.0.0.0:<port>`, auth from extra args | dev auth there now needs `--insecure-dev-auth`: added to `tests/bridge_e2e.rs` (ignored test), `hosting/scripts/fleet-local/fleet.mjs`, `hosting/scripts/docker-smoke.sh` and the `hosting/README.md` docker example; README gains a public-deployment checklist (real credentials, `--ws-origins`/`--api-cors-origins` for the Unity WebGL origin, proxy header, no `--self-signed`) |
| `crates/rh-load` (`runner.rs` sampler and final report) | `players`, `lobbies` and the final info object from public `/info` | **changed**: reads `/control/info` on the control address it already starts the server with (`--control`; after the resilience merge also `--control-insecure-loopback`, which that branch adds to `server.rs`); works for TLS runs too (control is plain HTTP) |
| `hosting/staging-mvp` | dev auth on 127.0.0.1 behind Caddy, no proxy header, no origins | still starts (not detectable as exposed); see open points |

## Gates

| Gate | Result |
|---|---|
| `cargo test -p rh-server` | 371 passed, 0 failed, 2 ignored (369 at f46ad7cc, before the review follow-up) |
| `cargo test -p rh-server --features postgres` (pgtest cluster) | 443 passed, 0 failed, 4 ignored (440 at f46ad7cc) |
| `cargo test -p rh-load` | 39 passed, 0 failed (smoke now asserts `/control/info` counters in the report and series) |
| `cargo clippy -p rh-server -p rh-load --all-targets -- -D warnings` (default and `--all-features`) | clean |
| `cargo fmt -p rh-server -p rh-load --check` | clean |
| `python3 -B -m unittest discover -s hosting/technical-demo -p 'test_*.py'` | 27 OK |
| `python3 -B -m unittest discover -s tools/staging-native-artifact -p 'test_*.py'` | 25 OK |

New tests: `src/edge.rs` 12 unit (origin policy, CORS, per-address cap and release, IPv6 /64, connect bucket, pending cap,
origin-before-count, loopback exemption vs forwarded address, failed-Hello throttle and refund, concurrent reservations, silent
and dripped-preface deadline); `src/main.rs` 5 (dev auth exposure matrix, self-signed and TLS pairing, edge flag defaults and
overrides, empty-origin rule, typo/bad-value refusals); `src/persist.rs` 1 (static tokens); `tests/edge.rs` 10 on the real serve
path (trimmed `/info` + `/control/info`, origin 403/101, `/ping` CORS, 429 per-address and rate, 503 pending, `RateLimited`
after 3 bad tickets while another address signs in, slowloris: silent / dripped preface / unfinished head closed within the
timeout while an upgraded socket outlives it, and 3 binary refusals). Mutation check: with the first-request deadline disabled
(`3600 s`), `slow_or_silent_http_clients_are_disconnected_by_the_header_timeout` fails.

Review follow-up tests: `edge::tests::behind_a_declared_proxy_an_unresolved_address_shares_one_capped_bucket` (missing,
repeated, unparsable, loopback-naming header and no peer all share one capped key, failed Hellos too; loopback stays exempt
without a header); `tests/edge.rs` `behind_a_declared_proxy_requests_without_one_forwarded_address_share_a_capped_bucket` (real
listener: no header, unparsable, raw repeated header -> 429) and `a_credential_store_outage_is_not_counted_as_failed_sign_ins`
(postgres feature: closed pool, budget 1 failure/minute, four Hellos all answered `RateLimited` "storage unavailable", never the
throttle). Mutation check: mapping the store error back to `BadCredentials` makes the outage test fail.

## Open points for the coordinator

* `docs/CONTRACTS.md` (not edited here, coordinator-owned) still describes `snapshotRefusals`/`frameRefusals`/`closedRooms`
  step stats and `resultsRefused` as carried by `/info`; they are now on `/control/info`. `docs/hosting/OBSERVABILITY.md` is updated.
* **Known gap: `hosting/staging-mvp`** (files not edited here) runs rh-server with dev auth on `127.0.0.1:7777` behind Caddy
  **without** `--client-ip-header`. The server cannot tell it is public, so: dev auth is still allowed (any callsign, any
  ticket), `/ws` accepts any browser origin, and every player arrives from the loopback proxy peer and is exempt from the
  per-address WebSocket limits and the failed-Hello throttle (only the global pending cap applies). Fix on that host: add
  `--client-ip-header x-forwarded-for --trusted-proxies 127.0.0.1 --api-cors-origins https://<page origin>` (it will then
  refuse dev auth, as intended, until it gets real credentials or an explicit `--insecure-dev-auth`).
* `hosting/glbridge` binds `0.0.0.0` without auth flags of its own; a real fleet must pass `--database-url` (or `--auth static:`)
  in the bridge's extra args, otherwise rh-server now exits 2 at startup.
* `tools/staging-native-artifact` runs a reviewed harness against a selected source commit: a new harness against a source
  commit older than this change will fail its readiness probe (no `/control/info`).
* A total TCP connection cap (sockets that never become `/ws`) is not added; such sockets are now bounded in time by the header
  timeout and TLS handshake timeout (axum-server default 10 s).
